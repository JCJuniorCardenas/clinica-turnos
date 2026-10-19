import "reflect-metadata";
import { config } from "dotenv";

config({ path: "../../.env", quiet: true });
process.env.LOGIN_RATE_LIMIT ??= "1000";
process.env.GLOBAL_RATE_LIMIT ??= "100000";
