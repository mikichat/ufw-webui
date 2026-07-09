import express, { type NextFunction, type Request, type Response } from "express";
import {
  authenticateUser,
  signupFirstUser,
  usersExist,
  verifyToken,
} from "../services/authService";

export const authRouter = express.Router();

type AuthenticatedRequest = Request & {
  user?: string | object;
};

// 일반 로그인. rate-limit 은 routes/index.ts 의 미들웨어에서 라우터에 부착한다.
authRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== "string" || typeof password !== "string") {
      throw new Error("Invalid username or password.");
    }
    const result = await authenticateUser(username, password);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error instanceof Error ? error.message : "Authentication failed.",
    });
  }
});

// 첫 관리자 부트스트랩. 사용자 파일이 비어 있을 때만 1회 성공. 그 외엔 403.
// 자체 별도 rate-limit 적용 (routes/index.ts 에서 미들웨어로 더 엄격히 제한).
authRouter.post("/bootstrap", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (typeof username !== "string" || typeof password !== "string") {
      throw new Error("Invalid input.");
    }
    const result = await signupFirstUser(username, password);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap failed.";
    res.status(403).json({ success: false, error: message });
  }
});

// 사용자 존재 여부 (UI 가 폼을 분기하기 위한 public 헬퍼).
authRouter.get("/users/exists", async (_req: Request, res: Response) => {
  try {
    const exists = await usersExist();
    res.json({ success: true, data: { exists } });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Lookup failed.",
    });
  }
});

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    res.status(401).json({ success: false, error: "Access denied" });
    return;
  }

  try {
    req.user = await verifyToken(token);
    next();
  } catch (_error) {
    res.status(400).json({ success: false, error: "Invalid token" });
  }
};
