import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://ayushbh.com/", changeFrequency: "monthly", priority: 1 },
    {
      url: "https://ayushbh.com/privacy/",
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];
}
