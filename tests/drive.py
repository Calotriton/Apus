"""What the browser app does with a Run: every recording, batch by batch, then the results."""
import json


def drive(run, infer, batch=16):
    """`infer(frames) -> logits` stands in for the model."""
    for f in run.todo:
        try:
            recording = run.open(f)
            for w0 in range(0, recording.n_windows, batch):
                run.add(f, w0, infer(run.frames(recording, w0, min(recording.n_windows, w0 + batch))))
        except Exception as exc:
            run.fail(f, exc)
            continue
        run.end_file(f)
    return json.loads(run.finish())
