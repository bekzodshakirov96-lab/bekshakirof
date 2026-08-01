import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { authenticateRequest } from "./localAuth";
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
  // Reverse proxy ortida ishlaganda haqiqiy mijoz IP'sini olish uchun (rate-limit shunga tayanadi).
  app.set("trust proxy", 1);
  // Mobil ilovani (Expo web) mahalliy kompyuterdan production API'ga qarshi sinash
  // uchun: faqat localhost/127.0.0.1'dan keladigan so'rovlarga CORS ruxsati beriladi
  // (istalgan portda) — haqiqiy tashqi saytlar bu orqali productionga so'rov yuborib,
  // javobni o'qiy olmaydi. Haqiqiy qurilmadagi mobil ilova (native RN fetch) CORS'ga
  // umuman bog'liq emas, shuning uchun bu faqat brauzer orqali sinash uchun kerak.
  const localOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && localOriginPattern.test(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  // Standart xavfsizlik header'lari. Vite dev serveri inline skript/HMR ishlatgani uchun
  // CSP faqat production'da yoqiladi.
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === "development" ? false : undefined,
      crossOriginEmbedderPolicy: false,
    }),
  );
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Parolni ketma-ket taxmin qilishga (brute-force) qarshi: bitta IP'dan 15 daqiqada
  // 20 ta login urinishi. Faqat login yo'liga qo'llanadi, oddiy ishlashga xalaqit bermaydi.
  app.use(
    "/api/trpc/auth.login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Juda ko'p urinish. 15 daqiqadan so'ng qayta urinib ko'ring." },
    }),
  );
  // Yuklangan fayllar (import qilingan Excel jadvallari) — butun savdo/mijoz ma'lumotini
  // o'z ichiga oladi, shuning uchun faqat tizimga kirgan foydalanuvchiga beriladi.
  app.use("/uploads", async (req, res, next) => {
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Avval tizimga kiring." });
      return;
    }
    next();
  });
  app.use("/uploads", express.static(UPLOADS_DIR));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      // To'liq xato (stack bilan) faqat server konsolida qoladi — klientga
      // yuboriladigan javobdan stack olib tashlangan (server/_core/trpc.ts).
      onError({ error, path }) {
        console.error(`[tRPC] ${path ?? "<unknown>"}:`, error);
      },
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
