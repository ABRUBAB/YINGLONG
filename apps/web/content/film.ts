/**
 * The project film and the demo clips. Every video button is on its page from the start. A video's window plays
 * the file once its path is listed in UPLOADED_VIDEOS (the file itself goes in apps/web/public/videos/); until
 * then the window says the video will be uploaded soon, so there is never a dead player.
 *
 * Files the pages ask for:
 *   /videos/yinglong-film.mp4  home page film band
 *   /videos/student-demo.mp4   Student demo page
 *   /videos/hack-demo.mp4      Challenge page
 */
export const FILM_SRC = "/videos/yinglong-film.mp4";

export const UPLOADED_VIDEOS: readonly string[] = [];

export const isUploaded = (src: string) => UPLOADED_VIDEOS.includes(src);
