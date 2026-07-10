import fs from "fs";
import path from "path";

// UFW_WEBUI_DATA_DIR 가 절대경로로 주입되면 거기로, 아니면 cwd/data.
// install-service.sh 는 systemd 유닛에 /var/lib/ufw-webui 로 박제한다.
export const dataDir: string = process.env.UFW_WEBUI_DATA_DIR
  ? path.resolve(process.env.UFW_WEBUI_DATA_DIR)
  : path.resolve(process.cwd(), "data");

export const ensureDataDir = (): void => {
  fs.mkdirSync(dataDir, { recursive: true });
};

export const backupsDir = (): string => path.join(dataDir, "backups");

export const ensureBackupsDir = (): void => {
  fs.mkdirSync(backupsDir(), { recursive: true });
};