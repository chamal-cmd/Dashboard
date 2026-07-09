import { getUser } from "@/lib/supabase/get-user";
import UsersPanel from "./_components/UsersPanel";

export default async function AdminUsersPage() {
  const user = await getUser();
  return (
    <div className="shellPage">
      <div className="shellPageTitle">Users</div>
      <div className="shellPageSub">Invite teammates, manage roles, and control access.</div>
      <UsersPanel selfId={user!.id} />
    </div>
  );
}
