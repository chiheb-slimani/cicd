import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home page", () => {
  it("renders CI/CD demo title", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: /next\.js ci\/cd demo/i }),
    ).toBeInTheDocument();
  });
});
