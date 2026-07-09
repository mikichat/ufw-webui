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

function LoginForm({ setIsLoggedIn }: { setIsLoggedIn: (isLoggedIn: boolean) => void }) {
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootstrapMode, setBootstrapMode] = useState(false);
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

  const handleLogin = async (values: FormValues) => {
    setLoading(true);
    try {
      const res = await apiAuth(values.username, values.password);
      handleAuthSuccess(res.data.data);
    } catch (error) {
      const m = error instanceof Error ? error.message : "Authentication failed.";
      message.error(m);
    } finally {
      setLoading(false);
    }
  };

  const handleBootstrap = async (values: FormValues) => {
    if (values.password !== values.confirm) {
      message.error("비밀번호와 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiBootstrapFirst(values.username, values.password);
      handleAuthSuccess(res.data.data);
    } catch (error) {
      const m = error instanceof Error ? error.message : "Bootstrap failed.";
      message.error(m);
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

        <Form<FormValues>
          onFinish={bootstrapMode ? handleBootstrap : handleLogin}
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
            style={{ width: "100%" }}
          >
            {bootstrapMode ? "관리자 등록" : "로그인"}
          </Button>
        </Form>
      </div>
    </div>
  );
}

export default LoginForm;
