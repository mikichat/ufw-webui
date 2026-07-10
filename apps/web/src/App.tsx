import { useState } from "react";
import { App as AntApp, ConfigProvider } from "antd";
import koKR from "antd/locale/ko_KR";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { useColorScheme } from "./hooks/useColorScheme";
import { darkTheme, lightTheme } from "./theme/tokens";
import LoginForm from "./components/LoginForm";
import UFWWebUI from "./components/UFWWebUI";

function App() {
  const { resolved, mode, setMode } = useColorScheme();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() =>
    Boolean(localStorage.getItem("token")),
  );

  return (
    <ConfigProvider locale={koKR} theme={resolved === "dark" ? darkTheme : lightTheme}>
      <AntApp>
        <Router>
          <Routes>
            <Route path="/login" element={<LoginForm setIsLoggedIn={setIsLoggedIn} />} />
            <Route
              path="/"
              element={
                isLoggedIn ? (
                  <UFWWebUI setIsLoggedIn={setIsLoggedIn} themeMode={mode} onThemeChange={setMode} />
                ) : (
                  <Navigate to="/login" />
                )
              }
            />
          </Routes>
        </Router>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;