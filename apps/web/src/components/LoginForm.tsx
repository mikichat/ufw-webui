import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Spin, message } from "antd";
import { useNavigate } from "react-router-dom";
import {
  apiAuth,
  apiBootstrapFirst,
  apiUsersExist,
  type AuthSuccess,
} from "../services/api";

type FormValues = {
  username: string;
  password: string;
  confirm?: string;
};

const isRateLimited = (err: unknown): { retryAfter: number } | null => {
  if (err && typeof err === "object" && "status" in err && "retryAfter" in err) {
    const e = err as { status?: number; retryAfter?: number };
    if (e.status === 429 && typeof e.retryAfter === "number") {
      return { retryAfter: e.retryAfter };
    }
  }
  return null;
};

function LoginForm({ setIsLoggedIn }: { setIsLoggedIn: (isLoggedIn: boolean) => void }) {
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [cooldown, setCooldown] = useState<number>(0);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiUsersExist();
        if (!cancelled) {
          setBootstrapMode(!res.data.data.exists);
        }
      } catch (error) {
        // network/mock error → 폼 자체는 로그인 모드로 표시하고 사용자가 시도하도록
        if (!cancelled) {
          setBootstrapMode(false);
        }
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 쿨다운 카운트다운. 0 이 되면 버튼 다시 활성화.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleAuthSuccess = (data: AuthSuccess) => {
    if (data.token) {
      localStorage.setItem("token", data.token);
      setIsLoggedIn(true);
      message.success(
        bootstrapMode ? "관리자 계정이 등록되었습니다." : "로그인에 성공했습니다.",
      );
      navigate("/");
    }
  };

  const handleAuthError = (error: unknown) => {
    const limited = isRateLimited(error);
    if (limited) {
      setCooldown(limited.retryAfter);
      message.error(
        `너무 많은 시도가 감지되었습니다. ${limited.retryAfter}초 후에 다시 시도해 주세요.`,
        limited.retryAfter,
      );
      return;
    }
    const m = error instanceof Error ? error.message : "Authentication failed.";
    message.error(m);
  };

  const handleLogin = async (values: FormValues) => {
    if (cooldown > 0) return;
    setLoading(true);
    try {
      const res = await apiAuth(values.username, values.password);
      handleAuthSuccess(res.data.data);
    } catch (error) {
      handleAuthError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrap = async (values: FormValues) => {
    if (cooldown > 0) return;
    if (values.password !== values.confirm) {
      message.error("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiBootstrapFirst(values.username, values.password);
      handleAuthSuccess(res.data.data);
    } catch (error) {
      handleAuthError(error);
    } finally {
      setLoading(false);
    }
  };

  if (bootstrapping) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          backgroundColor: "#f0f2f5",
        }}
      >
        <Spin tip="확인 중..." />
      </div>
    );
  }

  const disabled = loading || cooldown > 0;

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        backgroundColor: "#f0f2f5",
      }}
    >
      <div
        style={{
          backgroundColor: "white",
          padding: "40px",
          borderRadius: "15px",
          width: "400px",
          boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)",
        }}
      >
        <h2 style={{ textAlign: "center", marginBottom: "20px" }}>
          {bootstrapMode ? "최초 관리자 설정" : "로그인"}
        </h2>

        {bootstrapMode && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="사용자 파일이 비어 있습니다."
            description="이 계정이 첫 관리자가 됩니다. 4자 이상의 안전한 비밀번호를 사용하세요."
          />
        )}

        {cooldown > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={`잠시 후 다시 시도해 주세요 (${cooldown}초)`}
            description="너무 많은 시도가 감지되어 일시적으로 차단되었습니다. 카운트다운이 끝나면 다시 시도할 수 있습니다."
          />
        )}

        <Form<FormValues>
          onFinish={bootstrapMode ? handleBootstrap : handleLogin}
          disabled={cooldown > 0}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: "아이디를 입력해 주세요." }]}
          >
            <Input placeholder="아이디" autoComplete="username" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: "비밀번호를 입력해 주세요." }]}
          >
            <Input.Password
              placeholder="비밀번호"
              autoComplete={bootstrapMode ? "new-password" : "current-password"}
            />
          </Form.Item>

          {bootstrapMode && (
            <Form.Item
              name="confirm"
              dependencies={["password"]}
              rules={[
                { required: true, message: "비밀번호 확인을 입력해 주세요." },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue("password") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("비밀번호가 일치하지 않습니다."));
                  },
                }),
              ]}
            >
              <Input.Password
                placeholder="비밀번호 확인"
                autoComplete="new-password"
              />
            </Form.Item>
          )}

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            disabled={disabled}
            style={{ width: "100%" }}
          >
            {cooldown > 0
              ? `대기 중 (${cooldown}초)`
              : bootstrapMode
                ? "관리자 등록"
                : "로그인"}
          </Button>
        </Form>
      </div>
    </div>
  );
}

export default LoginForm;
