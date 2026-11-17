import { useEffect, useState } from 'react';
import type { AppSettings } from '../shared/types';

export function useBackgroundImage(settings: AppSettings) {
  const [image, setImage] = useState<{ url: string; error: string }>({ url: '', error: '' });
  const id = settings.backgroundImage?.id;
  useEffect(() => {
    let current = true;
    setImage({ url: '', error: '' });
    if (id) {
      void window.mindnote
        .getBackgroundImageURL(id, settings.reduceMotion)
        .then((url) => {
          if (current) setImage({ url: url ?? '', error: url ? '' : '背景图片暂不可用，请重新添加。' });
        })
        .catch(() => {
          if (current) setImage({ url: '', error: '背景图片读取失败，请重试。' });
        });
    }
    return () => {
      current = false;
    };
  }, [id, settings.reduceMotion]);
  return image;
}

export function BackgroundLayer({ settings }: { settings: AppSettings }) {
  const { url } = useBackgroundImage(settings);
  if (!settings.backgroundImage) return null;
  return (
    <div className="app-background" aria-hidden="true">
      {url && <img src={url} alt="" draggable={false} />}
    </div>
  );
}
