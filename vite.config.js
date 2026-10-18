import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        auto: "auto.html",
        redeem: "redeem.html",
        manual: "manual.html",
        developer: "developer.html",
        devsupport: "devsupport.html",
        giftCodes: "gift-codes.html",
        info: "info.html",
        message: "message.html",
        privacy: "privacy.html",
        profile: "profile.html",
        push: "push.html",
        terms: "terms.html",
      },
    },
  },
});
