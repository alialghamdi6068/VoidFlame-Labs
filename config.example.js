// Copy to config.js only if you want to override the API URL locally.
// This file must contain public URLs only. Never put OAuth secrets or database credentials in browser code.
window.VOIDFLAME_CONFIG = {
  apiBaseUrl: "https://REPLACE_WITH_CLOUDFLARE_WORKER_HOST",
  catalogueUrl: "./data/projects.json"
};
