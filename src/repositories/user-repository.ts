import type { Prisma } from "@prisma/client";

/** Public user projection. The password hash is NEVER selected by the app. */
export const userPublicSelect = {
  id: true,
  displayName: true,
  email: true,
  role: true,
  title: true,
  teamId: true,
  isActive: true,
  trackingConsent: true,
  consentUpdatedAt: true,
  lastLoginAt: true,
  createdAt: true,
  team: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;
