import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ path: "api/.env" });

const dbUrl = process.env["DATABASE_URL"];
const directUrl = process.env["DIRECT_URL"] || dbUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: dbUrl,
    directUrl,
  },
});
