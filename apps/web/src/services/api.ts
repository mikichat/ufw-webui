import axios from "axios";
import type { BulkRuleLine, LogLevel, Rule } from "@ufw-webui/shared";
import type { InternalAxiosRequestConfig } from "axios";

const api = axios.create({
  baseURL: "/api",
});

api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: unknown) => Promise.reject(error),
);

// 응답 본문이 { success: false, error } 인 경우 axios 가 잡을 수 있도록 reject.
// 실제 백엔드(4xx/5xx)와 mockjs(200 + success:false) 모두 일관되게 catch 로 흐르게 한다.
// 429 의 경우 retryAfter 를 Error 객체에 첨부해 UI 가 카운트다운을 표시할 수 있게 한다.
api.interceptors.response.use(
  (response) => {
    if (
      response.data &&
      typeof response.data === "object" &&
      (response.data as { success?: boolean }).success === false
    ) {
      const message = (response.data as { error?: string }).error ?? "Request failed";
      return Promise.reject(new Error(message));
    }
    return response;
  },
  (error) => {
    if (error?.response?.status === 429) {
      const body = error.response.data as { error?: string; retryAfter?: number } | undefined;
      const msg = body?.error ?? "너무 많은 요청. 잠시 후 다시 시도하세요.";
      const retryAfter = typeof body?.retryAfter === "number" ? body.retryAfter : undefined;
      const err = new Error(retryAfter ? `${msg} (${retryAfter}초 대기)` : msg) as Error & {
        status?: number;
        retryAfter?: number;
      };
      err.status = 429;
      err.retryAfter = retryAfter;
      return Promise.reject(err);
    }
    return Promise.reject(error);
  },
);

// ── 인증 ────────────────────────────────────────────────────────────────

export type AuthSuccess = {
  token: string;
  user: { username: string };
};

export const apiAuth = (username: string, password: string) =>
  api.post<{ success: true; data: AuthSuccess }>("/auth", { username, password });

export const apiUsersExist = () =>
  api.get<{ success: true; data: { exists: boolean } }>("/auth/users/exists");

export const apiBootstrapFirst = (username: string, password: string) =>
  api.post<{ success: true; data: AuthSuccess }>("/auth/bootstrap", {
    username,
    password,
  });

// ── UFW 즉시 적용 ───────────────────────────────────────────────────────

export const apiGetUfwStatus = () => api.get("/ufw/status");
export const apiEnableUfw = () => api.post("/ufw/enable");
export const apiDisableUfw = () => api.post("/ufw/disable");
export const apiAddRule = (rule: Rule) => api.post("/ufw/add", { rule });
export const apiDeleteRule = (rule: Rule) => api.post("/ufw/delete", { rule });

// ── 모니터링(대기) 작업 ──────────────────────────────────────────────────

export type StagedInput = Rule & {
  action?: "add" | "delete";
  note?: string;
};

export const apiListStaged = () => api.get("/ufw/staged");
export const apiAddStaged = (input: StagedInput) =>
  api.post("/ufw/staged", { rule: input });
export const apiRemoveStaged = (id: string) => api.delete(`/ufw/staged/${id}`);
export const apiApplyStagedOne = (id: string) =>
  api.post(`/ufw/staged/${id}/apply`);
export const apiApplyStagedAll = () => api.post("/ufw/staged/apply-all");

// ── UFW 로깅 / 로그 ─────────────────────────────────────────────────────

export const apiGetLogLevel = () =>
  api.get<{
    success: true;
    data: {
      level: LogLevel;
      file: string | null;
      source?: "file" | "journal" | "none";
    };
  }>("/ufw/logging");

export const apiSetLogLevel = (level: LogLevel) =>
  api.post("/ufw/logging", { level });

export const apiGetRecentLogs = (limit: number) =>
  api.get(`/ufw/logs?limit=${limit}`);

// ── 대량 규칙 ──────────────────────────────────────────────────────────

export type BulkMode = "apply" | "monitor";
export type BulkAction = "add" | "delete";

export type BulkRequest = {
  mode: BulkMode;
  action: BulkAction;
  rules: BulkRuleLine[];
};

export type BulkResponse = {
  mode: BulkMode;
  action: BulkAction;
  applied: number;
  total: number;
  errors?: string[];
};

export const apiBulkRules = (req: BulkRequest) =>
  api.post<{ success: true; data: BulkResponse }>("/ufw/bulk", req);

// ── 규칙 수정 (delete + add 시퀀스) ──────────────────────────────────

export type UpdateMode = "apply" | "monitor";

export type UpdateRequest = {
  old: Rule;
  new: Rule;
  mode: UpdateMode;
  note?: string;
};

export type UpdateResponse =
  | {
      mode: "monitor";
      staged: number;
      message: string;
      rule: unknown;
    }
  | {
      mode: "apply";
      applied: number;
      result: string;
    };

export const apiUpdateRule = (req: UpdateRequest) =>
  api.post<{ success: true; data: UpdateResponse }>("/ufw/update", req);
