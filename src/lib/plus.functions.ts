import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

type UserSubscription = Tables<"user_subscriptions">;

type StripeReference = string | { id?: string | null } | null | undefined;

type StripeSubscription = {
  id: string;
  status: string;
  customer?: StripeReference;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
};

type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  mode?: string | null;
  client_reference_id?: string | null;
  customer?: StripeReference;
  subscription?: StripeReference | StripeSubscription;
};

type StripePortalSession = {
  id: string;
  url?: string | null;
};

type StripeErrorPayload = {
  error?: {
    message?: string;
  };
};

export type LumePlusSubscriptionState = {
  active: boolean;
  status: string;
  priceLabel: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  customerId: string | null;
  subscriptionId: string | null;
};

const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";
const DEFAULT_PLUS_PRICE_LABEL = "Monthly subscription";
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

const originSchema = z.object({
  origin: z.string().trim().min(1).max(300),
});

const confirmCheckoutSchema = z.object({
  sessionId: z.string().trim().min(8).max(255),
});

function getPriceLabel() {
  return (
    process.env["LUME_PLUS_PRICE_LABEL"]?.trim() || DEFAULT_PLUS_PRICE_LABEL
  );
}

function getStripeSecretKey() {
  const secretKey = process.env["STRIPE_SECRET_KEY"]?.trim();
  if (!secretKey) {
    throw new Error(
      "Lume Plus payments need STRIPE_SECRET_KEY in the server environment.",
    );
  }
  return secretKey;
}

function getStripeCheckoutConfig() {
  const secretKey = getStripeSecretKey();
  const priceId = process.env["STRIPE_LUME_PLUS_PRICE_ID"]?.trim();
  if (!priceId) {
    throw new Error(
      "Lume Plus payments need STRIPE_LUME_PLUS_PRICE_ID in the server environment.",
    );
  }
  return { secretKey, priceId };
}

function hasStripeSecretKey() {
  return Boolean(process.env["STRIPE_SECRET_KEY"]?.trim());
}

function getSafeOrigin(origin: string) {
  const parsed = new URL(origin);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Checkout needs a valid app URL.");
  }
  return parsed.origin;
}

function getStripeReferenceId(value: StripeReference) {
  if (!value) return null;
  return typeof value === "string" ? value : (value.id ?? null);
}

function isStripeSubscription(
  value: StripeCheckoutSession["subscription"],
): value is StripeSubscription {
  return Boolean(
    value &&
    typeof value === "object" &&
    "status" in value &&
    typeof value.status === "string",
  );
}

function stripeTimestampToIso(timestamp: number | null | undefined) {
  return timestamp ? new Date(timestamp * 1000).toISOString() : null;
}

function isActiveSubscriptionStatus(status: string | null | undefined) {
  return ACTIVE_SUBSCRIPTION_STATUSES.has(status ?? "");
}

function toSubscriptionState(
  row: UserSubscription | null,
): LumePlusSubscriptionState {
  return {
    active: isActiveSubscriptionStatus(row?.status),
    status: row?.status ?? "inactive",
    priceLabel: getPriceLabel(),
    currentPeriodEnd: row?.current_period_end ?? null,
    cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
    customerId: row?.stripe_customer_id ?? null,
    subscriptionId: row?.stripe_subscription_id ?? null,
  };
}

function isMissingSubscriptionTable(error: {
  code?: string;
  message?: string;
}) {
  return (
    error.code === "42P01" ||
    error.message?.includes("user_subscriptions") === true
  );
}

async function stripeRequest<T>({
  path,
  secretKey,
  method = "POST",
  body,
}: {
  path: string;
  secretKey: string;
  method?: "GET" | "POST";
  body?: URLSearchParams;
}): Promise<T> {
  const requestInit: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${secretKey}`,
      ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
  };
  if (body) {
    requestInit.body = body;
  }

  const response = await fetch(`${STRIPE_API_BASE_URL}${path}`, requestInit);
  const payload = (await response
    .json()
    .catch(() => null)) as StripeErrorPayload | null;

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Stripe request failed (${response.status}).`,
    );
  }

  return payload as T;
}

async function getSupabaseAdminClient() {
  const { getSupabaseAdmin } =
    await import("@/integrations/supabase/client.server");
  return getSupabaseAdmin();
}

async function getStoredSubscription(
  userId: string,
  options: { requireTable?: boolean } = {},
) {
  const supabaseAdmin = await getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingSubscriptionTable(error)) {
      if (!options.requireTable) return null;
      throw new Error(
        "Run the Lume Plus subscription migration before enabling payments.",
      );
    }
    throw new Error(error.message);
  }

  return data;
}

async function upsertSubscriptionFromStripe({
  userId,
  subscription,
  fallbackCustomerId,
}: {
  userId: string;
  subscription: StripeSubscription;
  fallbackCustomerId?: string | null;
}) {
  const customerId =
    getStripeReferenceId(subscription.customer) ?? fallbackCustomerId ?? null;
  const row: TablesInsert<"user_subscriptions"> = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: stripeTimestampToIso(subscription.current_period_end),
    cancel_at_period_end: subscription.cancel_at_period_end ?? false,
  };

  const supabaseAdmin = await getSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from("user_subscriptions")
    .upsert(row, { onConflict: "user_id" })
    .select("*")
    .single();

  if (error) {
    if (isMissingSubscriptionTable(error)) {
      throw new Error(
        "Run the Lume Plus subscription migration before enabling payments.",
      );
    }
    throw new Error(error.message);
  }

  return data;
}

async function syncStoredSubscription(row: UserSubscription | null) {
  if (!row?.stripe_subscription_id || !hasStripeSecretKey()) return row;

  try {
    const subscription = await stripeRequest<StripeSubscription>({
      path: `/subscriptions/${encodeURIComponent(row.stripe_subscription_id)}`,
      secretKey: getStripeSecretKey(),
      method: "GET",
    });
    return upsertSubscriptionFromStripe({
      userId: row.user_id,
      subscription,
      fallbackCustomerId: row.stripe_customer_id,
    });
  } catch (error) {
    console.warn("[Lume Plus] Could not refresh Stripe subscription", error);
    return row;
  }
}

export const getLumePlusSubscription = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LumePlusSubscriptionState> => {
    const row = await getStoredSubscription(context.userId);
    return toSubscriptionState(await syncStoredSubscription(row));
  });

export const createLumePlusCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => originSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { secretKey, priceId } = getStripeCheckoutConfig();
    const origin = getSafeOrigin(data.origin);
    const storedSubscription = await getStoredSubscription(context.userId, {
      requireTable: true,
    });
    const { data: authData } = await context.supabase.auth.getUser();
    const customerId = storedSubscription?.stripe_customer_id;
    const customerEmail = authData.user?.email;

    const body = new URLSearchParams({
      mode: "subscription",
      client_reference_id: context.userId,
      success_url: `${origin}/lobby?plus=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/lobby?plus=cancelled`,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      "metadata[lume_user_id]": context.userId,
      "subscription_data[metadata][lume_user_id]": context.userId,
    });

    if (customerId) {
      body.set("customer", customerId);
    } else if (customerEmail) {
      body.set("customer_email", customerEmail);
    }

    const session = await stripeRequest<StripeCheckoutSession>({
      path: "/checkout/sessions",
      secretKey,
      body,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }

    return { url: session.url };
  });

export const confirmLumePlusCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => confirmCheckoutSchema.parse(input))
  .handler(async ({ data, context }): Promise<LumePlusSubscriptionState> => {
    const session = await stripeRequest<StripeCheckoutSession>({
      path: `/checkout/sessions/${encodeURIComponent(
        data.sessionId,
      )}?expand[]=subscription`,
      secretKey: getStripeSecretKey(),
      method: "GET",
    });

    if (session.client_reference_id !== context.userId) {
      throw new Error("This checkout session belongs to another account.");
    }
    if (session.mode !== "subscription") {
      throw new Error("This checkout session is not a subscription.");
    }
    if (!isStripeSubscription(session.subscription)) {
      throw new Error("Stripe has not attached a subscription yet.");
    }

    const row = await upsertSubscriptionFromStripe({
      userId: context.userId,
      subscription: session.subscription,
      fallbackCustomerId: getStripeReferenceId(session.customer),
    });

    return toSubscriptionState(row);
  });

export const createLumePlusPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => originSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const origin = getSafeOrigin(data.origin);
    const storedSubscription = await getStoredSubscription(context.userId, {
      requireTable: true,
    });
    const customerId = storedSubscription?.stripe_customer_id;

    if (!customerId) {
      throw new Error("Subscribe to Lume Plus before opening billing.");
    }

    const body = new URLSearchParams({
      customer: customerId,
      return_url: `${origin}/lobby`,
    });
    const portalSession = await stripeRequest<StripePortalSession>({
      path: "/billing_portal/sessions",
      secretKey: getStripeSecretKey(),
      body,
    });

    if (!portalSession.url) {
      throw new Error("Stripe did not return a billing portal URL.");
    }

    return { url: portalSession.url };
  });
