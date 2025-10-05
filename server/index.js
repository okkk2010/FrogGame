import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = Number(process.env.PORT ?? 3000);
const distDir = resolve(__dirname, "../dist");

app.use(express.static(distDir));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("*", (_req, res) => {
  res.sendFile(resolve(distDir, "index.html"), (error) => {
    if (error) {
      res.status(200).send("Build artifacts are missing. Run npm run build and try again.");
    }
  });
});

app.listen(port, () => {
  console.log(`Local showcase server ready on http://localhost:${port}`);
});
