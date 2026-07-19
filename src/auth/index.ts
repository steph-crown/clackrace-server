import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { db } from "../db/client.js";
import * as schema from "../db/schema.js";
import { env } from "../env.js";
import { pickRandomCarColor } from "../lib/car-colors.js";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      carColor: {
        type: "string",
        required: false,
        /** Server-owned at signup; change via PATCH /me */
        input: false,
      },
      font: {
        type: "string",
        required: false,
      },
      avatar: {
        type: "string",
        required: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => ({
          data: {
            ...user,
            carColor: pickRandomCarColor(),
          },
        }),
      },
    },
  },
  plugins: [
    // Enforces unique usernames (DB also has UNIQUE on user.username).
    username({
      minUsernameLength: 3,
      maxUsernameLength: 24,
    }),
  ],
  trustedOrigins: [...env.corsOrigins],
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: env.isProd,
      path: "/",
    },
  },
  baseURL: env.appUrl,
  secret: env.betterAuthSecret,
});

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  carColor?: string | null;
  font?: string | null;
  avatar?: string | null;
};
