import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { UPLOADS_DIR } from "../storage";
import { serveStatic, setupVite } from "./vite";

// Kun chegaralari (Kassa, hisobotlar) server jarayonining LOKAL vaqt mintaqasiga tayanadi
// (masalan, `new Date(...).setHours(0,0,0,0)`). Biznes doim Toshkentda ishlaydi, shuning
// uchun server qayerda joylashgan bo'lishidan qat'iy nazar (o'zingizdagi kompyuter, keyinchalik
// bulutli xizmat — ular ko'pincha UTC bilan ishlaydi) shu vaqt mintaqasi qattiq belgilanadi.
// .env faylida TZ o'rnatilsa, o'sha qiymat ustunlik qiladi. Har qanday Date hisob-kitobidan
// oldin ishga tushishi kerak, shuning uchun barcha importlardan keyin, lekin startServer()
// chaqirilishidan oldin turibdi.
process.env.TZ = process.env.TZ || "Asia/Tashkent";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Uploaded files (e.g. imported Excel workbooks) are stored on local disk
  // and served back from here. See server/storage.ts.
  app.use("/uploads", express.static(UPLOADS_DIR));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
