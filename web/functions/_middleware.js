// test.arkhampad.com opens the testnet page; everything else passes through unchanged.
export async function onRequest({ request, next }) {
  const u = new URL(request.url);
  if (u.hostname.startsWith("test.") && (u.pathname === "/" || u.pathname === "")) {
    return Response.redirect(`${u.origin}/testnet/`, 302);
  }
  return next();
}
