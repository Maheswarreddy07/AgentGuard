import { useState } from "react";

/** A page-local "Technical details" switch (closed by default). Returns [open, setOpen]. There is no global mode. */
export const useTechnical = () => useState(false);
