import { SupabaseClient } from "@supabase/supabase-js";

interface EdgeFunctionOptions {
  method?: "POST" | "GET" | "PUT" | "DELETE";
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

interface EdgeFunctionResult<T = unknown> {
  data: T | null;
  error: Error | null;
}

/**
 * Invoke an edge function with better error handling and response parsing.
 * Captures detailed error information from non-2xx responses.
 */
export async function invokeEdgeFunction<T = unknown>(
  supabase: SupabaseClient,
  functionName: string,
  options: EdgeFunctionOptions = {}
): Promise<EdgeFunctionResult<T>> {
  try {
    const response = await supabase.functions.invoke(functionName, {
      method: options.method || "POST",
      headers: options.headers,
      body: options.body,
    });

    // Check if there's an error from the client
    if (response.error) {
      console.error(`[${functionName}] Supabase client error:`, {
        message: response.error.message,
        status: (response.error as any).status,
      });
      return {
        data: null,
        error: new Error(`${functionName} failed: ${response.error.message}`),
      };
    }

    // Check if response is in error range or has an error field
    if (response.data?.error) {
      console.error(`[${functionName}] Response error:`, response.data.error);
      return {
        data: null,
        error: new Error(response.data.error),
      };
    }

    return {
      data: response.data as T,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] Exception:`, err);
    return {
      data: null,
      error: new Error(`${functionName} exception: ${message}`),
    };
  }
}
