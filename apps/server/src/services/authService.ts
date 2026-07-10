import crypto from "crypto";
import * as bcrypt from "bcryptjs";
import fs from "fs";
import { jwtVerify, SignJWT } from "jose";
import path from "path";

const dataDir = process.env.UFW_WEBUI_DATA_DIR
  ? path.resolve(process.env.UFW_WEBUI_DATA_DIR)
  : path.resolve(process.cwd(), "data");
const usersFilePath = path.join(dataDir, "users.json");

// JWT 시크릿. 환경변수 UFW_WEBUI_JWT_SECRET 가 있으면 사용, 없으면 경고 후 기본값 사용.
// 기본값은 외부 노출이 부적절하지만, 환경변수 미설정으로 서버가 아예 안 뜨는 것보다는
// 명시적인 경고 + 기본값으로라도 부팅되는 편이 운영자가 문제를 빨리 인지하게 한다.
const DEFAULT_JWT_SECRET = "UFW-WebUI";
const envJwtSecret = process.env.UFW_WEBUI_JWT_SECRET;

if (!envJwtSecret) {
  console.warn(
    "[WARN] UFW_WEBUI_JWT_SECRET 환경변수가 설정되지 않았습니다. " +
      "기본 시크릿으로 JWT 를 발급합니다. 프로덕션에서는 반드시 강력한 랜덤값으로 설정하세요.",
  );
}

const jwtSecret = new TextEncoder().encode(envJwtSecret ?? DEFAULT_JWT_SECRET);

const BCRYPT_ROUNDS = 10;

// 32 바이트 랜덤 hex 를 만들어 비밀번호 솔트로 쓰던 "114514" 시절 잔재.
// 이번 단계에서는 마이그레이션 호환을 위해서만 사용한다.
const LEGACY_SALT = "114514";

type StoredUser = {
  username: string;
  password: string;
  // bcrypt 해시는 "$2b$" / "$2a$" 로 시작. 이 형식이면 이미 마이그레이션 완료.
  // 그 외 (예: 64자 hex) 는 레거시 SHA256+LEGACY_SALT 형식으로 간주.
};

const ensureDataDir = () => {
  fs.mkdirSync(dataDir, { recursive: true });
};

const getUsers = (): StoredUser[] => {
  try {
    const data = fs.readFileSync(usersFilePath, "utf8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
  } catch (_error) {
    return [];
  }
};

const writeUsers = (users: StoredUser[]) => {
  ensureDataDir();
  fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), "utf8");
};

const isBcryptHash = (s: string): boolean => /^\$2[aby]\$\d{2}\$/.test(s);

const isLegacySha256Hex = (s: string): boolean => /^[0-9a-f]{64}$/.test(s);

const legacyHash = (plain: string): string =>
  crypto.createHash("sha256").update(plain + LEGACY_SALT).digest("hex");

const updateUserPassword = (username: string, newHash: string) => {
  const users = getUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) {
    return false;
  }
  users[idx] = { ...users[idx], password: newHash };
  writeUsers(users);
  return true;
};

export type AuthResult = {
  token: string;
  user: { username: string };
};

const issueToken = async (username: string): Promise<string> => {
  return new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(jwtSecret);
};

export const authenticateUser = async (
  username: string,
  plainPassword: string,
): Promise<AuthResult> => {
  const users = getUsers();
  const user = users.find((u) => u.username === username);

  if (!user) {
    throw new Error("Invalid username or password.");
  }

  let ok = false;

  if (isBcryptHash(user.password)) {
    // 1) 정상 경로: bcrypt 비교
    ok = await bcrypt.compare(plainPassword, user.password);
  } else if (isLegacySha256Hex(user.password)) {
    // 2) 레거시 마이그레이션: SHA256(pw+LEGACY_SALT) 와 비교 후 일치하면 bcrypt 로 업그레이드
    if (legacyHash(plainPassword) === user.password) {
      ok = true;
      const newHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
      updateUserPassword(username, newHash);
      console.log(`[auth] 사용자 '${username}' 비밀번호를 bcrypt 로 마이그레이션했습니다.`);
    }
  } else {
    // 알 수 없는 형식은 비교 불가
    ok = false;
  }

  if (!ok) {
    throw new Error("Invalid username or password.");
  }

  return {
    token: await issueToken(user.username),
    user: { username: user.username },
  };
};

// 사용자 파일이 비어 있을 때만 첫 관리자 등록을 허용. 그 외엔 throw.
export const signupFirstUser = async (
  username: string,
  plainPassword: string,
): Promise<AuthResult> => {
  const users = getUsers();
  if (users.length > 0) {
    throw new Error("Bootstrap 은 사용자 파일이 비어 있을 때만 사용할 수 있습니다.");
  }
  if (!username || !plainPassword) {
    throw new Error("아이디와 비밀번호를 모두 입력해야 합니다.");
  }
  if (plainPassword.length < 4) {
    throw new Error("비밀번호는 4 자 이상이어야 합니다.");
  }
  const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
  writeUsers([{ username, password: hash }]);
  console.log(`[auth] 첫 관리자 '${username}' 등록 완료.`);
  return {
    token: await issueToken(username),
    user: { username },
  };
};

export const usersExist = async (): Promise<boolean> => {
  return getUsers().length > 0;
};

export const verifyToken = async (token: string) => {
  try {
    const { payload } = await jwtVerify(token, jwtSecret);
    return payload;
  } catch (_error) {
    throw new Error("Invalid token.");
  }
};
