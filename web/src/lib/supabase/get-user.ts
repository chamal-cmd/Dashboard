import { cache } from "react";
import { createClient } from "./server";

// Wrapped in React's cache() so a layout and its page can both call
// getUser() within one render and only pay for one round-trip.
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
