import { getLogger } from "@logtape/logtape";
import type { ActorDispatcher } from "../federation/callback.ts";
import type { RequestContext } from "../federation/context.ts";
import { Link as LinkObject } from "../vocab/mod.ts";
import type { Link, ResourceDescriptor } from "./jrd.ts";

const logger = getLogger(["fedify", "webfinger", "server"]);

/**
 * Parameters for {@link handleWebFinger}.
 */
export interface WebFingerHandlerParameters<TContextData> {
  /**
   * The request context.
   */
  context: RequestContext<TContextData>;

  /**
   * The callback for dispatching the actor.
   */
  actorDispatcher?: ActorDispatcher<TContextData>;

  /**
   * The function to call when the actor is not found.
   */
  onNotFound(request: Request): Response | Promise<Response>;
}

/**
 * Handles a WebFinger request.  You would not typically call this function
 * directly, but instead use {@link Federation.handle} method.
 * @param request The WebFinger request to handle.
 * @param parameters The parameters for handling the request.
 * @returns The response to the request.
 */
export async function handleWebFinger<TContextData>(
  request: Request,
  {
    context,
    actorDispatcher,
    onNotFound,
  }: WebFingerHandlerParameters<TContextData>,
): Promise<Response> {
  if (actorDispatcher == null) return await onNotFound(request);
  const resource = context.url.searchParams.get("resource");
  if (resource == null) {
    return new Response("Missing resource parameter.", { status: 400 });
  }
  let resourceUrl: URL;
  try {
    resourceUrl = new URL(resource);
  } catch (e) {
    if (e instanceof TypeError) {
      return new Response("Invalid resource URL.", { status: 400 });
    }
    throw new e();
  }
  let handle: string | null;
  const uriParsed = context.parseUri(resourceUrl);
  if (uriParsed?.type != "actor") {
    const match = /^acct:([^@]+)@([^@]+)$/.exec(resource);
    if (match == null || match[2] != context.url.host) {
      return await onNotFound(request);
    }
    handle = match[1];
  } else {
    handle = uriParsed.handle;
  }
  if (actorDispatcher == null) {
    logger.error("Actor dispatcher is not set.", { handle });
    return await onNotFound(request);
  }
  const actor = await actorDispatcher(context, handle);
  if (actor == null) {
    logger.error("Actor {handle} not found.", { handle });
    return await onNotFound(request);
  }
  const links: Link[] = [
    {
      rel: "self",
      href: context.getActorUri(handle).href,
      type: "application/activity+json",
    },
  ];
  for (const url of actor.urls) {
    if (url instanceof LinkObject && url.href != null) {
      links.push({
        rel: url.rel ?? "http://webfinger.net/rel/profile-page",
        href: url.href.href,
        type: url.mediaType == null ? undefined : url.mediaType,
      });
    } else if (url instanceof URL) {
      links.push({
        rel: "http://webfinger.net/rel/profile-page",
        href: url.href,
      });
    }
  }
  const jrd: ResourceDescriptor = {
    subject: `acct:${handle}@${context.url.host}`,
    aliases: [context.getActorUri(handle).href],
    links,
  };
  return new Response(JSON.stringify(jrd), {
    headers: {
      "Content-Type": "application/jrd+json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
