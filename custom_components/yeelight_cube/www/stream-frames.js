// The frames a lamp's stream sends, pushed by the integration
// (yeelight_cube/stream_frames, stream_preview_ws.py): while the lamp streams
// an effect or clock, a live preview shows exactly what the lamp was sent,
// not its own drawing of the effect (its own start and random seeds).
// One subscription per lamp, shared by every preview that shows it.

// A frame older than this is no longer shown (ms): the stream stopped, the
// preview draws the effect itself again (as the camera, light_studio's
// STREAM_PREVIEW_FRESH).
export const STREAM_FRAME_FRESH_MS = 1000;

const subscriptions = new Map();

function decodeFrame(text) {
  const bytes = atob(text);
  const frame = [];
  for (let index = 0; index + 2 < bytes.length; index += 3)
    frame.push([
      bytes.charCodeAt(index),
      bytes.charCodeAt(index + 1),
      bytes.charCodeAt(index + 2),
    ]);
  return frame;
}

function close(subscription) {
  subscription.unsubscribe
    ?.then((unsubscribe) => unsubscribe?.())
    .catch(() => {});
}

/** The streamed frames of `entityId` over `connection`: `latest()` gives the
 * last one (lamp order, the colours a preview shows, before its brightness
 * boost) while it is recent, else null; `release()` when no longer shown. */
export function acquireStreamFrames(connection, entityId) {
  let subscription = subscriptions.get(entityId);
  if (!subscription || subscription.connection !== connection) {
    if (subscription) close(subscription);
    subscription = { connection, frame: null, at: 0, users: 0 };
    subscription.unsubscribe = connection
      .subscribeMessage(
        (message) => {
          if (typeof message?.frame !== "string") return;
          subscription.frame = decodeFrame(message.frame);
          subscription.at = Date.now();
        },
        { type: "yeelight_cube/stream_frames", entity_id: entityId },
      )
      // An older integration without the command: previews draw as before.
      .catch(() => null);
    subscriptions.set(entityId, subscription);
  }
  subscription.users += 1;
  let released = false;
  return {
    latest() {
      return subscription.frame &&
        Date.now() - subscription.at < STREAM_FRAME_FRESH_MS
        ? subscription.frame
        : null;
    },
    release() {
      if (released) return;
      released = true;
      subscription.users -= 1;
      if (subscription.users <= 0 && subscriptions.get(entityId) === subscription) {
        subscriptions.delete(entityId);
        close(subscription);
      }
    },
  };
}
