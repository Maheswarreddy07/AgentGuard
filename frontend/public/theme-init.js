// Runs before the page paints so the chosen theme never flashes. (A file, not inline, so the strict Content-Security-Policy allows it.)
try { document.documentElement.dataset.theme = localStorage.getItem("ag.theme") || "system"; } catch (e) { document.documentElement.dataset.theme = "system"; }
