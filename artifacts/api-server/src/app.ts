import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use("/objects", express.static(path.join(process.cwd(), "uploads")));

const examDist = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../fellowship-exam/dist",
);

if (fs.existsSync(examDist)) {
  // Serve static files from the build directory
  app.use(express.static(examDist));

  // Handle SPA routing: any non-API route serves index.html
  app.get("/*", (req, res, next) => {
    // Skip API and static objects
    if (req.path.startsWith("/api") || req.path.startsWith("/objects")) {
      return next();
    }
    res.sendFile(path.join(examDist, "index.html"));
  });
}

export default app;
