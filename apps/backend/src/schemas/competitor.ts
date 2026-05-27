import { z } from "zod";

export const saveCompetitorsSchema = z.object({
  competitors: z.array(
    z.object({
      title: z.string(),
      externalId: z.string().nullable(),
      rawPrice: z.string().nullable(),
      extractedPrice: z.number().positive(),
      rawOldPrice: z.string().nullable(),
      extractedOldPrice: z.number().positive().nullable(),
      currency: z.string().nullable().default(null),
      source: z.string(),
      link: z.string(),
      thumbnail: z.string().nullable(),
      tag: z.string().nullable()
    })
  ).min(1)
});
