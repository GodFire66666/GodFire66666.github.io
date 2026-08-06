---
title: Breaking Complex Problems into Verifiable Steps
description: A good plan should not only sound reasonable; every step should be observable and testable.
published: 2026-08-02
tags:
  - methods
  - work
---

When a problem is complicated, it is tempting to jump straight to the final answer. The harder and more useful task is building a reliable path from what we know now to what we want to know next.

I like to begin with three questions:

1. Which facts are already certain?
2. Which assumption is most likely to change the conclusion?
3. What is the smallest next step that can distinguish between the remaining explanations?

## Walking Back from Conclusions to Evidence

Suppose a metric drops. Saying “the model became worse” is rarely useful because it does not tell us what to do next. A more productive decomposition looks like this:

```text
Metric changed
  -> Which examples changed?
  -> Which scenarios contain most of the change?
  -> Did the input, reasoning, or evaluation rule cause it?
  -> What is the smallest experiment that can verify the cause?
```

Every arrow produces something we can inspect. Even when the first guess is wrong, we can see exactly where the reasoning stopped matching reality.

## Leave a Trace

Verification does not have to mean bureaucracy. A small table, a short log, or a few aligned examples can be enough to move a discussion from opinion back to evidence.

A good process does not guarantee that we always guess correctly. It makes mistakes visible sooner and lets the useful parts become reusable.
