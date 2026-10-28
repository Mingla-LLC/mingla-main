import { Modal, ModalBody } from "../ui/Modal";
import { BlogMediaLibrary } from "./BlogMediaLibrary";
export function BlogMediaPicker({open,onClose,api,onPick}) { return <Modal open={open} onClose={onClose} title="Choose a blog photo" size="lg"><ModalBody><BlogMediaLibrary api={api} picker onPick={(item)=>{onPick(item);onClose();}} /></ModalBody></Modal>; }
