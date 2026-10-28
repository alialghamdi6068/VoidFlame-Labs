// Public frontend configuration. This file must never contain secrets.
window.VOIDFLAME_CONFIG = {
  // Set this to the deployed Cloudflare Worker origin, e.g. https://ali-labs-api.<account>.workers.dev
  // Leave empty to use the reviewed static JSON catalogue until the API is deployed.
  apiBaseUrl: "",
  catalogueUrl: "./data/projects.json"
};
