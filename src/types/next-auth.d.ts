import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
    /** Epoch ms of the sign-in that issued this session. */
    authTime?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    authTime?: number;
  }
}
