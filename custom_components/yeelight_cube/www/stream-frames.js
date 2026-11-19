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
    // The frame as sent (base64), unpacked when a preview asks for it: frames
    // arrive 25 a second, a preview may paint fewer (or none: hidden tab).
    subscription = { connection, text: null, frame: null, unpacked: null, at: 0, users: 0 };
    // A connection without subscriptions (a test page): no frames.
    subscription.unsubscribe =
      typeof connection.subscribeMessage !== "function"
        ? null
        : connection
            .subscribeMessage(
              (message) => {
                if (typeof message?.frame !== "string") return;
                subscription.text = message.frame;
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
      if (!subscription.text || Date.now() - subscription.at >= STREAM_FRAME_FRESH_MS)
        return null;
      // The same array while no new frame came: a caller can tell a frame it
      // already painted.
      if (subscription.unpacked !== subscription.text) {
        subscription.unpacked = subscription.text;
        subscription.frame = decodeFrame(subscription.text);
      }
      return subscription.frame;
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
