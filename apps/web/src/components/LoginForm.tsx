import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Spin, Typography, message, theme } from "antd";
import { useNavigate } from "react-router-dom";
import { Mono } from "../theme/Mono";
import {
  apiAuth,
  apiBootstrapFirst,
  apiUsersExist,
  type AuthSuccess,
} from "../services/api";

const { Title, Text } = Typography;

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
  const { token } = theme.useToken();
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
          minHeight: "100vh",
          background: token.colorBgLayout,
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
        minHeight: "100vh",
        background: token.colorBgLayout,
        padding: 24,
      }}
    >
      <div
        style={{
          background: token.colorBgContainer,
          padding: "40px 36px",
          borderRadius: token.borderRadiusLG,
          width: 420,
          maxWidth: "100%",
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <Mono
            block
            style={{
              fontSize: 12,
              letterSpacing: "0.18em",
              color: token.colorPrimary,
              marginBottom: 8,
            }}
          >
            UFW · WEBUI
          </Mono>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
            {bootstrapMode ? "최초 관리자 설정" : "로그인"}
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {bootstrapMode
              ? "첫 관리자 계정을 등록합니다."
              : "Linux ufw 방화벽 관리 콘솔"}
          </Text>
        </div>

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
          layout="vertical"
        >
          <Form.Item
            name="username"
            label={<Mono style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token.colorTextTertiary }}>아이디</Mono>}
            rules={[{ required: true, message: "아이디를 입력해 주세요." }]}
            style={{ marginBottom: 16 }}
          >
            <Input placeholder="admin" autoComplete="username" size="large" />
          </Form.Item>

          <Form.Item
            name="password"
            label={<Mono style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: token.colorTextTertiary }}>비밀번호</Mono>}
            rules={[{ required: true, message: "비밀번호를 입력해 주세요." }]}
            style={{ marginBottom: 16 }}
          >
            <Input.Password
              placeholder="••••••••"
              autoComplete={bootstrapMode ? "new-password" : "current-password"}
              size="large"
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
              style={{ marginBottom: 24 }}
            >
              <Input.Password
                placeholder="비밀번호 확인"
                autoComplete="new-password"
                size="large"
              />
            </Form.Item>
          )}

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            disabled={disabled}
            block
            size="large"
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