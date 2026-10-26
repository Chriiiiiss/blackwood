import { useEffect, useState } from "react";

export function usePhotoSource(file: File | null) {
  const [source, setSource] = useState<{ file: File; url: string } | null>(
    null,
  );
  useEffect(() => {
    if (!file) {
      setSource(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSource({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return source?.file === file ? source.url : null;
}
