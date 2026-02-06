import PropTypes from "prop-types";
import { Fragment } from "react";
import { Link } from "react-router-dom";

export function Breadcrumbs({ items }) {
  if (!items.length) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="text-xs uppercase tracking-wide text-slate-500 whitespace-nowrap">
      <ol className="flex items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isCurrent = item.current || isLast;
          const content = item.href && !isCurrent ? (
            <Link
              to={item.href}
              className="text-slate-400 hover:text-slate-200"
              aria-current={isCurrent ? "page" : undefined}
            >
              {item.label}
            </Link>
          ) : (
            <span
              className={isCurrent ? "text-slate-200" : "text-slate-500"}
              aria-current={isCurrent ? "page" : undefined}
            >
              {item.label}
            </span>
          );

          return (
            <Fragment key={`${item.label}-${index}`}>
              <li>{content}</li>
              {!isLast ? <li className="text-slate-700">/</li> : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

Breadcrumbs.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string.isRequired,
      href: PropTypes.string.isRequired,
      current: PropTypes.bool.isRequired,
    }).isRequired
  ).isRequired,
};

Breadcrumbs.defaultProps = {
  items: [],
};
