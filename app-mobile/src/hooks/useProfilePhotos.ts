import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { uploadProfilePhoto, deleteProfilePhoto, getProfilePhotos } from '../services/profilePhotosService';
import { useAppStore } from '../store/appStore';

export const profilePhotoKeys = {
  all: ['profile-photos'] as const,
  user: (userId: string) => [...profilePhotoKeys.all, userId] as const,
};

export function useProfilePhotos() {
  const user = useAppStore((s) => s.user);
  return useQuery({
    queryKey: profilePhotoKeys.user(user?.id ?? ''),
    queryFn: () => getProfilePhotos(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000, // 5 min — photos change rarely
  });
}

export function useUploadProfilePhoto() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  return useMutation({
    mutationFn: ({ imageUri, position }: { imageUri: string; position: number }) =>
      uploadProfilePhoto(user!.id, imageUri, position),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profilePhotoKeys.user(user!.id) });
    },
  });
}

export function useDeleteProfilePhoto() {
  const queryClient = useQueryClient();
  const user = useAppStore((s) => s.user);
  return useMutation({
    mutationFn: (position: number) => deleteProfilePhoto(user!.id, position),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profilePhotoKeys.user(user!.id) });
    },
  });
}
