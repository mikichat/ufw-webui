import Mock from "mockjs";

type StoredUser = { username: string; password: string };

const STORAGE_KEY = "mock-users";

const loadUsers = (): StoredUser[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoredUser[];
  } catch (_error) {
    // fall through
  }
  return [];
};

const saveUsers = (users: StoredUser[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(users));
};

const MOCK_TOKEN = "mock-jwt-token";

Mock.mock("/api/auth/users/exists", "get", () => ({
  success: true,
  data: { exists: loadUsers().length > 0 },
}));

Mock.mock("/api/auth", "post", (options: { body: string }) => {
  const body = JSON.parse(options.body) as { username: string; password: string };
  const users = loadUsers();
  const found = users.find(
    (u) => u.username === body.username && u.password === body.password,
  );
  if (!found) {
    return {
      success: false,
      error: "Invalid username or password.",
    };
  }
  return {
    success: true,
    data: {
      token: MOCK_TOKEN,
      user: { username: found.username },
    },
  };
});

Mock.mock("/api/auth/bootstrap", "post", (options: { body: string }) => {
  const body = JSON.parse(options.body) as { username: string; password: string };
  if (loadUsers().length > 0) {
    return {
      success: false,
      error: "Bootstrap 은 사용자 파일이 비어 있을 때만 사용할 수 있습니다.",
    };
  }
  if (!body.username || !body.password) {
    return {
      success: false,
      error: "아이디와 비밀번호를 모두 입력해야 합니다.",
    };
  }
  saveUsers([{ username: body.username, password: body.password }]);
  return {
    success: true,
    data: {
      token: MOCK_TOKEN,
      user: { username: body.username },
    },
  };
});
