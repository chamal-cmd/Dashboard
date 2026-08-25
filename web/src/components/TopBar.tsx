import GlobalSearch from "./GlobalSearch";
import Chatbot from "./Chatbot";
import "./topbar.css";

// Sticky header above every dashboard page's content — big search on the
// left (pods/bookkeepers/Hiver inboxes/pages, see GlobalSearch), assistant
// launcher pinned to the top-right corner.
export default function TopBar() {
  return (
    <div className="topBar">
      <GlobalSearch />
      <Chatbot />
    </div>
  );
}
