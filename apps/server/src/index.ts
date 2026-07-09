import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import path from "path";
import { authRouter } from "./routes/auth";
import ufwRoutes from "./routes/ufw";
import stagedRoutes from "./routes/staged";
import logsRoutes from "./routes/logs";

const app = express();

// 정적 자산은 인증 미들웨어 앞에 둔다 (HTML/CSS/JS 자체는 공개).
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(cors());
app.use(bodyParser.json());

// /api/auth/* 에 대한 일반 로그인 시도 제한.
// in-memory store; 분당 10회. IP 당. 무차별 대입을 늦추는 1차 방어.
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many login attempts. 잠시 후 다시 시도하세요." },
});

// bootstrap 엔드포인트는 더 엄격: 5분에 3회. 한 번만 사용해야 정상 흐름.
const bootstrapLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many bootstrap attempts." },
});

app.use("/api/auth/", authLimiter);
app.use("/api/auth/bootstrap", bootstrapLimiter);

app.use("/api/auth", authRouter);
app.use("/api/ufw", ufwRoutes);
app.use("/api/ufw", stagedRoutes);
app.use("/api/ufw", logsRoutes);

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// reverse proxy 가 앞에 있는 것이 전제이므로 loopback 만 바인딩.
// 외부에서 :3000 으로 직접 접근 불가. nginx 가 :443 으로 받고 프록시.
const port = 3000;
app.listen(port, "127.0.0.1", () => {
  console.log(`Server is running on http://127.0.0.1:${port}`);
});
