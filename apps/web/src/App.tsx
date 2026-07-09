import { useState } from "react";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";
import { ConfigProvider } from "antd";
import koKR from "antd/locale/ko_KR";
import LoginForm from "./components/LoginForm";
import UFWWebUI from "./components/UFWWebUI";

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => Boolean(localStorage.getItem("token")));

  return (
    <ConfigProvider locale={koKR}>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginForm setIsLoggedIn={setIsLoggedIn} />} />
          <Route
            path="/"
            element={
              isLoggedIn ? <UFWWebUI setIsLoggedIn={setIsLoggedIn} /> : <Navigate to="/login" />
            }
          />
        </Routes>
      </Router>
    </ConfigProvider>
  );
}

export default App;
