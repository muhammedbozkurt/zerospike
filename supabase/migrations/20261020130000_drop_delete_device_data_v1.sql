-- delete_device_data(text) was replaced by delete_device_data_v2(text, text) when
-- delete-device moved to v2. No function or app code calls the first version any more
-- (the deployed delete-device calls v2), and it lacks the subscription app-user match,
-- the 'ce:' counter and the feedback rows, so a manual call would delete less than
-- promised. Idempotent: drop function if exists.

drop function if exists public.delete_device_data(text);
