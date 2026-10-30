export function failureReason(err) {
  return /quota/i.test(String(err?.message ?? err)) ? "quota" : "error";
}
