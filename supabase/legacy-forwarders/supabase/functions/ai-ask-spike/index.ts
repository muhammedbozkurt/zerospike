import { forward } from "../_shared/forward.ts";

Deno.serve(forward("ai-ask-spike", 75_000));
