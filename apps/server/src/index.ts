import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import path from "path";
import { authRouter } from "./routes/auth";
import ufwRoutes from "./routes/ufw";
import stagedRoutes from "./routes/staged";
import logsRoutes from "./routes/logs";
import bulkRoutes from "./routes/bulk";
import backupRoutes from "./routes/backup";

const app = express();

// 정적 자산은 인증 미들웨어 앞에 둔다 (HTML/CSS/JS 자체는 공개).
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(cors());
app.use(bodyParser.json());

// /api/auth/* POST 요청에 대한 로그인 시도 제한.
//   - GET (예: /api/auth/users/exists) 은 rate-limit 카운트에서 제외 (public probe)
//   - skipSuccessfulRequests: true → 성공한 로그인은 카운트하지 않음. 오직 실패한 시도만 카운트.
//   - in-memory store; 분당 10회. IP 당. 무차별 대입을 늦추는 1차 방어.
const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => req.method === "GET",
  handler: (_req, res, _next, options) => {
    const retryAfterSec = Math.ceil(options.windowMs / 1000);
    res.status(options.statusCode).json({
      success: false,
      error: "너무 많은 로그인 시도가 감지되었습니다. 잠시 후 다시 시도해 주세요.",
      retryAfter: retryAfterSec,
    });
  },
});

// bootstrap 엔드포인트는 더 엄격: 5분에 3회. 한 번만 사용해야 정상 흐름.
const bootstrapLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    const retryAfterSec = Math.ceil(options.windowMs / 1000);
    res.status(options.statusCode).json({
      success: false,
      error: "너무 많은 부트스트랩 시도가 감지되었습니다. 잠시 후 다시 시도해 주세요.",
      retryAfter: retryAfterSec,
    });
  },
});

app.use("/api/auth/", authLimiter);
app.use("/api/auth/bootstrap", bootstrapLimiter);

app.use("/api/auth", authRouter);
app.use("/api/ufw", ufwRoutes);
app.use("/api/ufw", stagedRoutes);
app.use("/api/ufw", logsRoutes);
app.use("/api/ufw", bulkRoutes);
app.use("/api/ufw", backupRoutes);

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// reverse proxy 가 앞에 있는 것이 전제이므로 loopback 만 바인딩.
// 외부에서 :3000 으로 직접 접근 불가. nginx 가 :443 으로 받고 프록시.
const port = 3000;
app.listen(port, "127.0.0.1", () => {
  console.log(`Server is running on http://127.0.0.1:${port}`);
});
