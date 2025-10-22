const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  center: [-98, 38.5],
  zoom: 4,
  attributionControl: false // disable default control so we can customize it
});

// Add custom attribution control with your link
map.addControl(
  new maplibregl.AttributionControl({
    compact: true,
    customAttribution:
      'Map data © <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors | ' +
      '<a href="https://googlemapsmania.blogspot.com/2025/10/county-stripes.html" target="_blank">About this map</a>'
  })
);

let counties;
let bandWidth = 2;
let colorMode = "area";
let bandGeoJSON;
let activePopup = null; // track open popup

map.on("load", async () => {
  const response = await fetch("countypops.geojson");
  counties = await response.json();

  // Compute derived properties
  counties.features.forEach(f => {
    const areaSqMiles = turf.area(f) / 2_589_988.11;
    const centroid = turf.centroid(f);
    const pop = Number(f.properties["Total Population"]) || 0;
    const density = pop / areaSqMiles;
    f.properties.area_sq_miles = parseFloat(areaSqMiles.toFixed(1));
    f.properties.centroid_lon = centroid.geometry.coordinates[0];
    f.properties.population = pop;
    f.properties.density = parseFloat(density.toFixed(2));
  });

  // Build longitude bands
  function createLongitudeBands(data, width, mode) {
    const bands = {};
    for (const f of data.features) {
      const lon = f.properties.centroid_lon;
      const bandStart = Math.floor(lon / width) * width;
      const key = `${bandStart}`;
      if (!bands[key]) bands[key] = [];
      if (mode === "population") bands[key].push(f.properties.population);
      else if (mode === "density") bands[key].push(f.properties.density);
      else bands[key].push(f.properties.area_sq_miles);
    }

    const features = [];
    for (const [bandStart, values] of Object.entries(bands)) {
      const bandStartNum = parseFloat(bandStart);
      const bandEnd = bandStartNum + width;
      const validVals = values.filter(v => v > 0);
      const avg = validVals.reduce((a, b) => a + b, 0) / (validVals.length || 1);
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [bandStartNum, 25],
            [bandEnd, 25],
            [bandEnd, 49],
            [bandStartNum, 49],
            [bandStartNum, 25]
          ]]
        },
        properties: { 
          avg_value: avg,
          bandStart: bandStartNum,
          bandEnd: bandEnd
        }
      });
    }
    return { type: "FeatureCollection", features };
  }

  // Paint expressions
  const countyPaints = {
    area: ["interpolate", ["linear"], ["get", "area_sq_miles"],
      0, "#edf8fb", 500, "#b2e2e2", 1000, "#66c2a4", 2000, "#238b45", 4000, "#00441b"],
    population: ["interpolate", ["linear"], ["get", "population"],
      0, "#fff5f0", 10000, "#fcbba1", 50000, "#fc9272", 200000, "#fb6a4a", 1000000, "#a50f15"],
    density: ["interpolate", ["linear"], ["get", "density"],
      0, "#f7fcf5", 10, "#c7e9c0", 100, "#74c476", 500, "#238b45", 2000, "#00441b"]
  };

  const bandPaints = {
    area: ["interpolate", ["linear"], ["get", "avg_value"],
      0, "#edf8fb", 500, "#b2e2e2", 1000, "#66c2a4", 2000, "#238b45", 4000, "#00441b"],
    population: ["interpolate", ["linear"], ["get", "avg_value"],
      0, "#fff5f0", 10000, "#fcbba1", 50000, "#fc9272", 200000, "#fb6a4a", 1000000, "#a50f15"],
    density: ["interpolate", ["linear"], ["get", "avg_value"],
      0, "#f7fcf5", 10, "#c7e9c0", 100, "#74c476", 500, "#238b45", 2000, "#00441b"]
  };

  // Add sources and layers
  map.addSource("counties", { type: "geojson", data: counties });
  map.addLayer({
    id: "county-fill",
    type: "fill",
    source: "counties",
    paint: { "fill-color": countyPaints[colorMode], "fill-opacity": 0.7 }
  });
  map.addLayer({
    id: "county-borders",
    type: "line",
    source: "counties",
    paint: { "line-color": "#333", "line-width": 0.4 }
  });

  bandGeoJSON = createLongitudeBands(counties, bandWidth, colorMode);
  map.addSource("lonbands", { type: "geojson", data: bandGeoJSON });
  map.addLayer({
    id: "lonband-fill",
    type: "fill",
    source: "lonbands",
    paint: { "fill-color": bandPaints[colorMode], "fill-opacity": 0.6 },
    layout: { visibility: "none" }
  });
  map.addLayer({
    id: "lonband-borders",
    type: "line",
    source: "lonbands",
    paint: { "line-color": "#ff6600", "line-width": 1.5, "line-dasharray": [2, 2] },
    layout: { visibility: "none" }
  });

  // Change cursor to pointer when hovering over clickable layers
map.on("mouseenter", "county-fill", () => {
  map.getCanvas().style.cursor = "pointer";
});
map.on("mouseleave", "county-fill", () => {
  map.getCanvas().style.cursor = "";
});

map.on("mouseenter", "lonband-fill", () => {
  map.getCanvas().style.cursor = "pointer";
});
map.on("mouseleave", "lonband-fill", () => {
  map.getCanvas().style.cursor = "";
});


  // === POPUPS ON CLICK ===
  function showPopup(lngLat, html) {
    if (activePopup) activePopup.remove();
    activePopup = new maplibregl.Popup({ closeButton: true })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
  }

  // County click
  map.on("click", "county-fill", (e) => {
    const f = e.features[0];
    const p = f.properties;
    const name = p.NAME || p.County || "Unnamed County";
    const html = `
      <strong>${name}</strong><br>
      Area: ${p.area_sq_miles.toLocaleString()} sq mi<br>
      Population: ${p.population.toLocaleString()}<br>
      Density: ${p.density.toLocaleString()} /sq mi
    `;
    showPopup(e.lngLat, html);
  });

  // Band click
  map.on("click", "lonband-fill", (e) => {
    const f = e.features[0];
    const p = f.properties;
    const html = `
      <strong>Longitude Band</strong><br>
      ${p.bandStart.toFixed(1)}° to ${p.bandEnd.toFixed(1)}° W<br>
      Average ${colorMode}: ${p.avg_value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
    `;
    showPopup(e.lngLat, html);
  });

  // Close popup on map click elsewhere
  map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ["county-fill", "lonband-fill"]
    });
    if (!features.length && activePopup) {
      activePopup.remove();
      activePopup = null;
    }
  });

  // === CONTROLS ===
  let mode = "county";
  const btn = document.getElementById("toggleBtn");
  const select = document.getElementById("colorMode");
  const slider = document.getElementById("bandWidthSlider");
  const bandValueDisplay = document.getElementById("bandValue");
  const legendDiv = document.getElementById("legend");

  function updateLegend(colorMode, viewMode) {
    const legendStops = {
      area: [0, 500, 1000, 2000, 4000],
      population: [0, 10000, 50000, 200000, 1000000],
      density: [0, 10, 100, 500, 2000]
    };
    const legendColors = {
      area: ["#edf8fb","#b2e2e2","#66c2a4","#238b45","#00441b"],
      population: ["#fff5f0","#fcbba1","#fc9272","#fb6a4a","#a50f15"],
      density: ["#f7fcf5","#c7e9c0","#74c476","#238b45","#00441b"]
    };

    const stops = legendStops[colorMode];
    const colors = legendColors[colorMode];
    let html = `<div class="legend-title">Color by ${colorMode.charAt(0).toUpperCase() + colorMode.slice(1)}</div>`;
    stops.forEach((v, i) => {
      html += `<div><span class="legend-color" style="background:${colors[i]}"></span>${v.toLocaleString()}</div>`;
    });
    if (colorMode === "population" && viewMode === "band") {
      html += `<div class="legend-note">Note: Longitude bands show <strong>average county population</strong>, not population density.</div>`;
    }
    legendDiv.innerHTML = html;
  }

  updateLegend(colorMode, mode);

  btn.addEventListener("click", () => {
    if (mode === "county") {
      map.setLayoutProperty("county-fill", "visibility", "none");
      map.setLayoutProperty("county-borders", "visibility", "none");
      map.setLayoutProperty("lonband-fill", "visibility", "visible");
      map.setLayoutProperty("lonband-borders", "visibility", "visible");
      btn.innerText = "Switch to County Coloring";
      mode = "band";
    } else {
      map.setLayoutProperty("county-fill", "visibility", "visible");
      map.setLayoutProperty("county-borders", "visibility", "visible");
      map.setLayoutProperty("lonband-fill", "visibility", "none");
      map.setLayoutProperty("lonband-borders", "visibility", "none");
      btn.innerText = "Switch to Longitude Bands";
      mode = "county";
    }
    updateLegend(colorMode, mode);
  });

  select.addEventListener("change", () => {
    colorMode = select.value;
    map.setPaintProperty("county-fill", "fill-color", countyPaints[colorMode]);
    map.setPaintProperty("lonband-fill", "fill-color", bandPaints[colorMode]);
    const newBands = createLongitudeBands(counties, bandWidth, colorMode);
    map.getSource("lonbands").setData(newBands);
    updateLegend(colorMode, mode);
  });

  slider.addEventListener("input", () => {
    const newWidth = parseFloat(slider.value);
    bandValueDisplay.textContent = newWidth.toFixed(1);
    const steps = 10;
    const stepSize = (newWidth - bandWidth) / steps;
    let currentStep = 0;
    function animateStep() {
      if (currentStep >= steps) return;
      const intermediateWidth = bandWidth + stepSize * (currentStep + 1);
      const intermediateBands = createLongitudeBands(counties, intermediateWidth, colorMode);
      map.getSource("lonbands").setData(intermediateBands);
      currentStep++;
      requestAnimationFrame(animateStep);
    }
    animateStep();
    bandWidth = newWidth;
  });
});
