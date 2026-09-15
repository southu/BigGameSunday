import { createFileRoute } from "@tanstack/react-router";
import { LegalDocument } from "@/components/bgs/LegalDocument";
import privacyPolicy from "../../content/legal/privacy-policy.md?raw";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Big Game Sunday" },
      {
        name: "description",
        content:
          "Privacy Policy for Big Game Sunday, a product of DP7, LLC. How we collect, use, and share information.",
      },
      { property: "og:title", content: "Privacy Policy — Big Game Sunday" },
      {
        property: "og:description",
        content:
          "Privacy Policy for Big Game Sunday, a product of DP7, LLC. How we collect, use, and share information.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return <LegalDocument markdown={privacyPolicy} current="privacy" />;
}
