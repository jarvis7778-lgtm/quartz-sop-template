import http from "node:http"
import handler from "serve-handler"

http
  .createServer((req, res) =>
    handler(req, res, { public: process.env.TEST_SITE_DIR || "public", cleanUrls: true }),
  )
  .listen(8791, "127.0.0.1")
